class ParticleSystem{
public:
  typedef VectorArray VectorArray;

  ParticleSystemData();
  virtual ~ParticleSystemData();
  void resize(int numberOfParticles);
  int numberOfParticles() const;

  const Vector3D* const forces() const;
  const Vector3D* const velocities() const;
  const Vector3D* const positions() const;

  void addParticles(
    const VectorArray& velocities,
    const VectorArray& positions,
  );
private:
  VectorArray forces;
  VectorArray velocities;
  VectorArray positions;
}
