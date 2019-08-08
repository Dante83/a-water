import os, time, re

def ShaderFileWatcher():
    #Reload a list of our file locations and write locations
    template_files = ['../js/ocean-system/shaders/LUTs/noise-shader-template.txt',\
    '../js/ocean-system/shaders/LUTs/h_0-shader-template.txt']
    shader_js_files = ['../js/ocean-system/shaders/LUTs/noise-shader.js',\
    '../js/ocean-system/shaders/LUTs/h_0-shader.js']
    shader_vertex_files = ['../glsl/gerstner-wave-LUTS/LUT-vertex.glsl',\
    '../glsl/gerstner-wave-LUTS/LUT-vertex.glsl']
    shader_fragment_files = ['../glsl/gerstner-wave-LUTS/noise-frag.glsl',\
    '../glsl/gerstner-wave-LUTS/h_0-frag.glsl']

    #Where is everything located? Give some relative paths that python can follow
    template_names = [os.path.abspath(x) for x in template_files]
    file_names = [os.path.abspath(x) for x in shader_js_files]
    vertex_files = [os.path.abspath(x) for x in shader_vertex_files]
    fragment_files = [os.path.abspath(x) for x in shader_fragment_files]

    num_files = len(template_names)
    previousVertexFileChangeDates = [None for x in xrange(num_files)]
    previousFragmentFileChangeDates = [None for x in xrange(num_files)]
    previousTemplateFileChangeDates = [None for x in xrange(num_files)]

    leadingSpacesBeforeFragmentShaderCode = [2 for x in xrange(num_files)]
    leadingSpacesBeforeVertextShaderCode = [2 for x in xrange(num_files)]

    #Initialize our template for usage - we're gonna need this one no matter what gets updated
    leadingSpacesBeforeVertextShaderCodeStrings = ['' for x in xrange(num_files)]
    updatedVertexFileCodeStrings = ['' for x in xrange(num_files)]
    updatedFragmentFileCodeStrings = ['' for x in xrange(num_files)]
    jsStringifiedVertexCode = ['' for x in xrange(num_files)]
    jsStringifiedFragmentCode = ['' for x in xrange(num_files)]
    templateStrings = ['' for x in xrange(num_files)]

    for i in xrange(num_files):
        template_name = template_names[i]
        with open(template_name, 'r') as f:
            templateStrings[i] = f.read()
        for loc in templateStrings[i]:
            if "\{vertex_glsl\}" in loc:
                 leadingSpacesBeforeVertextShaderCodeStrings[i] = len(loc) - len(loc.lstrip(' '))
            elif "\{vertex_glsl\}" in loc:
                leadingSpacesBeforeVertextShaderCodeStrings[i] = len(loc) - len(loc.lstrip(' '))

        #initialize our code strings
        vertex_file = vertex_files[i]
        with open(vertex_file) as vf:
            updatedVertexFileCodeStrings[i] = vf.read()

        fragment_file = fragment_files[i]
        with open(fragment_file) as ff:
            updatedFragmentFileCodeStrings[i] = ff.read()

    #Endless while loop - exit via ctrl-pause/break... It's just above that numpad block on your keyboard. You're welcome ^_^.
    while 1:
        #Do this every 1 seconds
        time.sleep(1)

        #For each of our shaders
        for i in xrange(num_files):
            #Prepare for this iteration
            vertex_file = vertex_files[i]
            fragment_file = fragment_files[i]
            template_name = template_names[i]
            file_name = file_names[i]
            previousVertexFileChangeDate = previousVertexFileChangeDates[i]
            previousFragmentFileChangeDate = previousFragmentFileChangeDates[i]
            previousTemplateFileChangeDate = previousTemplateFileChangeDates[i]

            #Check for changes
            vertexFileLastChangedAt = os.path.getmtime(vertex_file)
            fragmentFileLastChangedAt = os.path.getmtime(fragment_file)
            templateFileLastChangedAt = os.path.getmtime(template_name)

            # Check if any files changed, and if so, update our output js shader file
            if (previousVertexFileChangeDate != vertexFileLastChangedAt) or (previousFragmentFileChangeDate != fragmentFileLastChangedAt) or (previousTemplateFileChangeDate != templateFileLastChangedAt):
                #Get the current time...
                time.ctime()

                #
                #Check if our vertex shader file was the changer - is so, update the internal values associated with this
                #
                if (previousVertexFileChangeDate != vertexFileLastChangedAt):
                    print "Vertex File Change Detected"
                    previousVertexFileChangeDates[i] = vertexFileLastChangedAt
                    with open(vertex_file) as vf:
                        updatedVertexFileCodeStrings[i] = vf.read()
                #
                #Check if our fragment shader file was the changer - is so, update the internal values associated with this
                #
                if (previousFragmentFileChangeDate != fragmentFileLastChangedAt):
                    print "Fragment File Change Detected"
                    previousFragmentFileChangeDates[i] = fragmentFileLastChangedAt
                    with open(fragment_file) as ff:
                        updatedFragmentFileCodeStrings[i] = ff.read()

                #
                #Check if our template file was the changer - is so, update the internal values associated with this
                #
                if (previousTemplateFileChangeDate != templateFileLastChangedAt):
                    print "Template file change detected."
                    previousTemplateFileChangeDates[i] = templateFileLastChangedAt

                    with open(template_name, 'r') as f:
                        templateStrings[i] = f.read()
                    for loc in templateStrings[i]:
                        if "\{vertex_glsl\}" in loc:
                            leadingSpacesBeforeVertextShaderCode[i] = len(loc) - len(loc.lstrip(' '))
                        elif "\{vertex_glsl\}" in loc:
                            leadingSpacesBeforeFragmentShaderCode[i] = len(loc) - len(loc.lstrip(' '))

                codeLines = updatedVertexFileCodeStrings[i].splitlines()
                jsStringifiedVertexLinesOfCode = []
                for lineNumber, loc in enumerate(codeLines):
                    if len(loc) >= 1:
                        nLeadingSpaces = len(loc) - len(loc.lstrip(' ')) + leadingSpacesBeforeVertextShaderCode[i] + 2
                        if lineNumber == 0:
                            jsStringifiedVertexLinesOfCode += [''] #Empty newline at start
                        jsStringifiedVertexLinesOfCode += [(' ' * nLeadingSpaces) + "'" + loc.lstrip(' ') + "',"]
                    else:
                        jsStringifiedVertexLinesOfCode += [loc]
                jsStringifiedVertexCode[i] = '\r\n'.join(jsStringifiedVertexLinesOfCode)

                codeLines = updatedFragmentFileCodeStrings[i].splitlines()
                jsStringifiedFragmentLinesOfCode = []
                for lineNumber, loc in enumerate(codeLines):
                    if len(loc) >= 1:
                        nLeadingSpaces = len(loc) - len(loc.lstrip(' ')) + leadingSpacesBeforeFragmentShaderCode[i] + 2
                        if lineNumber == 0:
                            jsStringifiedFragmentLinesOfCode += [''] #Empty newline at start
                        jsStringifiedFragmentLinesOfCode += [(' ' * nLeadingSpaces) + "'" + loc.lstrip(' ') + "',"]
                    else:
                        jsStringifiedFragmentLinesOfCode += [loc]
                jsStringifiedFragmentCode[i] = '\r\n'.join(jsStringifiedFragmentLinesOfCode)

                #Clone the template string and modify it with the imported components
                with open(file_name, 'w') as w:
                    shader_js_code = templateStrings[i]
                    shader_js_code = re.sub('\s+\{vertex_glsl\}', jsStringifiedVertexCode[i], shader_js_code)
                    shader_js_code = re.sub('\s+\{fragment_glsl\}', jsStringifiedFragmentCode[i], shader_js_code)
                    w.write(shader_js_code)
                    print ("Shader JS File updated at: " + time.strftime('%H:%M %Y-%m-%d'))
                    print "-"*15

#Run the main application! :D
ShaderFileWatcher()
